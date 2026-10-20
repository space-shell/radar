import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Inbox } from "./client/inbox";
import { Settings } from "./client/settings";
import { InboxItem } from "./client/sidebar";

const SCREEN_ID = "inbox";

const SidebarItem = (props: PluginSidebarItemProps) => (
  <InboxItem {...props} screenId={SCREEN_ID} />
);

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN_ID, title: "Radar", Component: Inbox });
  client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Radar", Component: SidebarItem });
  // Under the host's own settings rather than a second screen of its own, because
  // this is where a Paseo user already looks for what a plugin can be told.
  client.addSettingsScreen({ id: "radar-settings", title: "Radar", icon: "Radar", Component: Settings });
  return () => {};
}
