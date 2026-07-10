import { log } from "../utils/logger";

type ComponentStatus = "healthy" | "degraded" | "failed";

interface Component {
  name: string;
  check: () => Promise<ComponentStatus>;
  restart: () => Promise<void>;
}

const components: Component[] = [];

export function registerComponent(component: Component): void {
  components.push(component);
}

export async function runSupervisor(): Promise<void> {
  log("Supervisor started");
  
  while (true) {
    for (const component of components) {
      try {
        const status = await component.check();
        
        if (status === "failed") {
          log(`${component.name} failed, attempting restart...`);
          await component.restart();
        } else if (status === "degraded") {
          log(`${component.name} is degraded`);
        }
      } catch (err) {
        log(`${component.name} check failed: ${err}`);
      }
    }
    
    await new Promise(r => setTimeout(r, 30000));
  }
}