import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Inbox } from "./client/inbox";
import { Settings } from "./client/settings";

const SCREEN_ID = "inbox";

function InboxItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Inbox"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN_ID, title: "Radar", Component: Inbox });
  client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Radar", Component: InboxItem });
  // Under the host's own settings rather than a second screen of its own, because
  // this is where a Paseo user already looks for what a plugin can be told.
  client.addSettingsScreen({ id: "radar-settings", title: "Radar", icon: "Radar", Component: Settings });
  return () => {};
}
