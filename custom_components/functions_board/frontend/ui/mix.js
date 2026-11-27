// Attach each UI part's methods onto FunctionsBoard.prototype, refusing any duplicate method name.
export function mixParts(BoardClass, parts) {
  const proto = BoardClass.prototype;
  const seen = new Map();
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name !== 'constructor') seen.set(name, 'core');
  }
  for (const [partName, methods] of parts) {
    for (const key of Object.getOwnPropertyNames(methods)) {
      if (seen.has(key)) {
        throw new Error(`FunctionsBoard method ${key} is defined in both ${seen.get(key)} and ${partName}`);
      }
      seen.set(key, partName);
      Object.defineProperty(proto, key, Object.getOwnPropertyDescriptor(methods, key));
    }
  }
}
