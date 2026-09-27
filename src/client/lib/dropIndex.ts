// Where in a vertical list a drop lands: the number of items whose middle is
// above the pointer. Shared by the native drag-and-drop on the Cards board and
// the Focus block, which had each worked it out their own way. Measured from
// the DOM, so it matches what is on screen whatever the items' heights.
export function indexAtPointer(items: Element[], y: number): number {
  return items.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2 < y;
  }).length;
}
