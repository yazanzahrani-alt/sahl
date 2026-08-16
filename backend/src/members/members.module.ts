import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { MockMemberLookupService } from "./mock-member-lookup.service";
import { MembersService } from "./members.service";

@Module({
  imports: [DatabaseModule],
  providers: [MockMemberLookupService, MembersService],
  exports: [MembersService]
})
export class MembersModule {}
