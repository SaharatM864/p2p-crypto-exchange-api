import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApiStandardResponse } from '../common/decorators/api-standard-response.decorator';
import { UserDto } from './dto/user.dto';
import { LoginResponseDto } from './dto/login-response.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'สมัครสมาชิกใหม่',
    description:
      'สร้างบัญชีผู้ใช้ใหม่ด้วยอีเมลและรหัสผ่าน ระบบจะสร้างกระเป๋าเงิน (Wallet) ให้อัตโนมัติสำหรับทุกสกุลเงินที่รองรับ (BTC, ETH, USDT, THB, USD) ไม่ต้องยืนยันตัวตน (Auth) ในการเรียกใช้',
  })
  @ApiStandardResponse(UserDto)
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'เข้าสู่ระบบ',
    description:
      'เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน เมื่อสำเร็จจะได้รับ JWT Token สำหรับใช้ยืนยันตัวตนใน API อื่นๆ ไม่ต้องยืนยันตัวตน (Auth) ในการเรียกใช้',
  })
  @ApiStandardResponse(LoginResponseDto)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}
