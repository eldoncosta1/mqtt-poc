import { IsString, MinLength } from 'class-validator'

export class RegisterDeviceDto {
  @IsString()
  @MinLength(1)
  externalId: string

  @IsString()
  @MinLength(1)
  name: string
}
