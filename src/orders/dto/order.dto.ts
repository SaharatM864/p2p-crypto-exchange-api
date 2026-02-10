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
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: OrderSide, enumName: 'OrderSide' })
  side!: OrderSide;

  @ApiProperty()
  cryptoCurrency!: string;

  @ApiProperty()
  fiatCurrency!: string;

  @ApiProperty()
  price!: string;

  @ApiProperty()
  totalAmount!: string;

  @ApiProperty()
  filledAmount!: string;

  @ApiProperty()
  minLimit!: string;

  @ApiProperty()
  maxLimit!: string;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status!: OrderStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
