import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

export function ApiAuthEndpoint(summary: string, description?: string) {
  return applyDecorators(
    ApiOperation({ summary, description }),
    ApiBearerAuth('access-token'),
    ApiResponse({
      status: 401,
      description: 'ไม่ได้ยืนยันตัวตน (Unauthorized)',
    }),
    ApiResponse({ status: 403, description: 'ไม่มีสิทธิ์เข้าถึง (Forbidden)' }),
    ApiResponse({
      status: 500,
      description: 'เกิดข้อผิดพลาดภายในระบบ (Internal Server Error)',
    }),
  );
}
