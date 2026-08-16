import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import {
  CLAIM_CATEGORIES,
  CLAIM_LOCATIONS,
  ClaimCategory,
  ClaimLocation,
  OPTICAL_ITEMS,
  OpticalItem
} from "../claim";

export class UpdateClaimDto {
  @ApiPropertyOptional({ enum: CLAIM_CATEGORIES, example: "dental" })
  @IsOptional()
  @IsIn(CLAIM_CATEGORIES)
  category?: ClaimCategory;

  @ApiPropertyOptional({
    enum: OPTICAL_ITEMS,
    nullable: true,
    example: "both",
    description: "Required when changing a claim to Optical; frames, lenses, or both"
  })
  @IsOptional()
  @IsIn(OPTICAL_ITEMS)
  opticalItem?: OpticalItem;

  @ApiPropertyOptional({ enum: CLAIM_LOCATIONS, example: "local" })
  @IsOptional()
  @IsIn(CLAIM_LOCATIONS)
  claimLocation?: ClaimLocation;
}
