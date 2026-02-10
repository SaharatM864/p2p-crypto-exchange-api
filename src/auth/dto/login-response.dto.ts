import { UserDto } from './user.dto';

export class LoginResponseDto {
  access_token!: string;
  user!: UserDto;
}
