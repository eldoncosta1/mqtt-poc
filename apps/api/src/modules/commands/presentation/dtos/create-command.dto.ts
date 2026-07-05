import { IsObject, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateCommandDto {
  @IsString()
  deviceId: string

  @IsString()
  @MinLength(1)
  type: string

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>
}
