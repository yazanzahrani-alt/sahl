import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class ConfirmValidationIssueDto {
  @ApiProperty({ example: "provider_mismatch" })
  @IsString()
  code!: string;

  @ApiPropertyOptional({ nullable: true, example: "ATT-123" })
  @IsOptional()
  @IsString()
  attachmentId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: "ATT-123:evidence:pages-1-1:invoice:abc:1" })
  @IsOptional()
  @IsString()
  evidenceUnitId?: string | null;
}
