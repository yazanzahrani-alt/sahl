import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import {
  CLAIM_CATEGORIES,
  CLAIM_LOCATIONS,
  ClaimCategory,
  ClaimLocation,
  OPTICAL_ITEMS,
  OpticalItem
} from "../claim";

export class CreateClaimDto {
  @ApiProperty({ enum: CLAIM_CATEGORIES, example: "dental" })
  @IsIn(CLAIM_CATEGORIES)
  category!: ClaimCategory;

  @ApiProperty({
    enum: OPTICAL_ITEMS,
    required: false,
    nullable: true,
    example: "both",
    description: "Required only when category is optical; frames, lenses, or both"
  })
  @IsOptional()
  @IsIn(OPTICAL_ITEMS)
  opticalItem?: OpticalItem;

  @ApiProperty({ enum: CLAIM_LOCATIONS, example: "local" })
  @IsIn(CLAIM_LOCATIONS)
  claimLocation!: ClaimLocation;
}
