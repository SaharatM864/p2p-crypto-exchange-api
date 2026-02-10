import { ApiProperty } from '@nestjs/swagger';

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderStatus {
  OPEN = 'OPEN',
  PARTIAL = 'PARTIAL',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class OrderDto {
  @ApiProperty({ example: 'uuid-order-id' })
  id!: string;

  @ApiProperty({ example: 'uuid-user-id' })
  userId!: string;

  @ApiProperty({ enum: OrderSide, enumName: 'OrderSide', example: 'SELL' })
  side!: OrderSide;

  @ApiProperty({ example: 'BTC' })
  cryptoCurrency!: string;

  @ApiProperty({ example: 'THB' })
  fiatCurrency!: string;

  @ApiProperty({ example: '1500000.00' })
  price!: string;

  @ApiProperty({ example: '1.5' })
  totalAmount!: string;

  @ApiProperty({ example: '0.0' })
  filledAmount!: string;

  @ApiProperty({ example: '100.00' })
  minLimit!: string;

  @ApiProperty({ example: '1000000.00' })
  maxLimit!: string;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus', example: 'OPEN' })
  status!: OrderStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
