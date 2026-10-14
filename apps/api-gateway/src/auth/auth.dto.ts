import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  API_KEY_MAX_PER_USER,
  API_KEY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USER_NAME_MAX_LENGTH,
} from '@pdp/contracts';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** One form per mailbox, as Metadata stores it, so rate limits and lookups agree. */
const NormaliseEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export class RegisterDto {
  @ApiProperty({ format: 'email', maxLength: EMAIL_MAX_LENGTH })
  @NormaliseEmail()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({
    maxLength: USER_NAME_MAX_LENGTH,
    description: 'Defaults to the part of the email before @.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(USER_NAME_MAX_LENGTH)
  name?: string;
}

export class LoginDto {
  @ApiProperty({ format: 'email' })
  @NormaliseEmail()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Null for API-key-only users.' })
  email!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class MeResponseDto extends UserResponseDto {
  @ApiProperty({ enum: ['api-key', 'session'], description: 'How this request was authenticated.' })
  authMethod!: 'api-key' | 'session';
}

export class CreateApiKeyDto {
  @ApiProperty({ maxLength: API_KEY_NAME_MAX_LENGTH, example: 'k6' })
  @IsString()
  @MinLength(1)
  @MaxLength(API_KEY_NAME_MAX_LENGTH)
  name!: string;
}

export class ApiKeyResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'First characters of the key.' })
  prefix!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Precise to a minute or so.',
  })
  lastUsedAt!: string | null;
}

export class CreatedApiKeyResponseDto extends ApiKeyResponseDto {
  @ApiProperty({ description: 'Shown only once; send it as X-API-Key.' })
  key!: string;
}

export class ListApiKeysResponseDto {
  @ApiProperty({
    type: [ApiKeyResponseDto],
    description: `Active keys, at most ${API_KEY_MAX_PER_USER}.`,
  })
  items!: ApiKeyResponseDto[];
}
