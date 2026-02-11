import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'ตรวจสอบสถานะระบบ',
    description:
      'เปิดสาธารณะ (ไม่ต้องยืนยันตัวตน) — ใช้ตรวจสอบว่า API Server ทำงานปกติหรือไม่',
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
