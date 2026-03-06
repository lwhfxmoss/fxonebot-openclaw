import type { OpenClawPluginApi, ChannelPlugin } from "openclaw/plugin-sdk/compat";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/compat";
import { onebotPlugin } from "./src/channel.js";
import { setOneBotRuntime } from "./src/runtime.js";

const plugin = {
  id: "onebot",
  name: "OneBot",
  description: "OneBot v11 channel plugin skeleton",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setOneBotRuntime(api.runtime);
    api.registerChannel({ plugin: onebotPlugin as ChannelPlugin });
  },
};

export default plugin;
