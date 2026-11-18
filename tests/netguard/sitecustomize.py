"""Test-only: logs every outgoing connection and name lookup the test Home Assistant makes, with the code behind it.

tests/start-ha.sh puts this folder on PYTHONPATH, so Python loads it when Home Assistant starts. It changes
nothing: each connection and lookup goes ahead as before, and one JSON line goes to $FB_NETGUARD_LOG saying where
it went and which files were on the stack. tests/e2e/privacy.test.js fails if any of those came from the
integration's files. Connections to this machine (127.0.0.1, ::1, localhost, Unix sockets) aren't logged.
It never ships: it lives in tests/ and only start-ha.sh uses it.
"""

import concurrent.futures.thread as _cft
import ipaddress
import json
import os
import socket
import threading
import time
import traceback

_LOG = os.environ.get("FB_NETGUARD_LOG")
_lock = threading.Lock()
# who handed a worker thread its job: Home Assistant runs blocking calls there (async_add_executor_job), and a
# worker's own stack doesn't show where the job came from
_origin = threading.local()


def _files(frames):
    out = []
    for fr in frames:
        if fr.filename not in out:
            out.append(fr.filename)
    return out


def _local(host):
    if host in (None, "", "localhost") or str(host).endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(str(host).split("%", 1)[0]).is_loopback
    except ValueError:
        return False


def _note(kind, host, port):
    if not _LOG or _local(host):
        return
    files = _files(traceback.extract_stack()[:-2])
    via = getattr(_origin, "files", None) or []
    line = json.dumps({"t": time.time(), "kind": kind, "host": str(host), "port": port, "stack": files[-40:], "via": via[-40:]})
    try:
        with _lock, open(_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


_connect, _connect_ex, _getaddrinfo = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo


def _addr(a):
    return (a[0], a[1]) if isinstance(a, tuple) and len(a) >= 2 else (None, None)


def connect(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        _note("connect", *_addr(address))
    return _connect(self, address)


def connect_ex(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        _note("connect", *_addr(address))
    return _connect_ex(self, address)


def getaddrinfo(host, port, *args, **kwargs):
    _note("lookup", host.decode() if isinstance(host, bytes) else host, port)
    return _getaddrinfo(host, port, *args, **kwargs)


_submit = _cft.ThreadPoolExecutor.submit


def submit(self, fn, /, *args, **kwargs):
    via = _files(traceback.extract_stack()[:-1]) + (getattr(_origin, "files", None) or [])

    def run(*a, **k):
        before = getattr(_origin, "files", None)
        _origin.files = via
        try:
            return fn(*a, **k)
        finally:
            _origin.files = before

    return _submit(self, run, *args, **kwargs)


if _LOG:
    _cft.ThreadPoolExecutor.submit = submit
    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = getaddrinfo
