"""Planted for the self-test (tests/selftest/run.js): one test passes, one fails on purpose."""


def test_passes() -> None:
    assert True


def test_planted_failure() -> None:
    assert False, "planted"
