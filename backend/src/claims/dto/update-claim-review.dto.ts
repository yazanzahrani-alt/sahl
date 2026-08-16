import { ApiProperty } from "@nestjs/swagger";
import { IsObject } from "class-validator";

export class UpdateClaimReviewDto {
  @ApiProperty({ type: "object", additionalProperties: true })
  @IsObject()
  extracted!: Record<string, unknown>;
}
