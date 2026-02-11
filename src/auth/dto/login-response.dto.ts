import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from './user.dto';

export class LoginResponseDto {
  @ApiProperty({ example: 'eyJh...' })
  accessToken!: string;

  @ApiProperty({ type: UserDto })
  user!: UserDto;
}
