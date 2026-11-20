/** Scrolls the sidebar just enough to show the row of the open bot or group chat. Returns whether that row is drawn. */
export function revealSidebarRow(root: ParentNode | null | undefined, id: string | null | undefined): boolean {
  if (!root || !id) return false;
  const row = [...root.querySelectorAll<HTMLElement>("[data-sidebar-bot-row], [data-sidebar-group-row]")]
    .find((element) => element.dataset.sidebarBotRow === id || element.dataset.sidebarGroupRow === id);
  row?.scrollIntoView({ block: "nearest" });
  return row !== undefined;
}
