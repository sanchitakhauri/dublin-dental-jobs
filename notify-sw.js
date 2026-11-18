self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const board = new URL("#jobs", self.registration.scope);
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = tabs.find((tab) => {
      const url = new URL(tab.url);
      return url.origin === board.origin && url.pathname === board.pathname;
    });
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: "show-job-listings" });
    } else {
      await self.clients.openWindow(board.href);
    }
  })());
});
