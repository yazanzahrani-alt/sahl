import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class OpsAccessService {
  constructor(private readonly config: ConfigService) {}

  isEnabled() {
    const configured = this.config.get<string>("DEMO_OPS_ENABLED");
    if (configured !== undefined) {
      return configured.trim().toLowerCase() === "true";
    }
    return this.config.get<string>("NODE_ENV") !== "production";
  }

  isEnabledFor(memberId: string) {
    return Boolean(memberId) && this.isEnabled();
  }

  assertAuthorized(memberId: string) {
    if (!this.isEnabledFor(memberId)) {
      throw new NotFoundException("Demo Ops view is not available.");
    }
  }

}
