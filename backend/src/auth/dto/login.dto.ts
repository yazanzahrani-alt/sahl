import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";
import { PASSWORD_POLICY } from "../password-policy";

export class LoginDto {
  @ApiProperty({
    example: "00123456",
    description:
      "An 8-digit Bupa member ID, a 10-digit National ID starting with 1, or a 10-digit Iqama starting with 2",
    minLength: 8,
    maxLength: 10
  })
  @IsString()
  @Matches(/^(?:\d{8}|1\d{9}|2\d{9})$/, {
    message:
      "Enter an 8-digit Member ID, a 10-digit National ID starting with 1, or a 10-digit Iqama starting with 2"
  })
  @Length(8, 10)
  identifier!: string;

  @ApiProperty({
    example: "SecurePass1!",
    description:
      "Password with at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character",
    minLength: PASSWORD_POLICY.minimumLength,
    maxLength: PASSWORD_POLICY.maximumLength
  })
  @IsString()
  @Length(
    PASSWORD_POLICY.minimumLength,
    PASSWORD_POLICY.maximumLength
  )
  password!: string;
}
