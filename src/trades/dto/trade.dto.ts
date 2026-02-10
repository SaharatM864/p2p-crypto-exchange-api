import { ApiProperty } from '@nestjs/swagger';

export enum TradeStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DISPUTE = 'DISPUTE',
}

export class TradeDto {
  @ApiProperty({ example: 'uuid-trade-id' })
  id!: string;

  @ApiProperty({ example: 'uuid-order-id' })
  orderId!: string;

  @ApiProperty({ example: 'uuid-buyer-id' })
  buyerId!: string;

  @ApiProperty({ example: 'uuid-seller-id' })
  sellerId!: string;

  @ApiProperty({ example: '0.5' })
  cryptoAmount!: string;

  @ApiProperty({ example: '750000.00' })
  fiatAmount!: string;

  @ApiProperty({ example: '1500000.00' })
  price!: string;

  @ApiProperty({
    enum: TradeStatus,
    enumName: 'TradeStatus',
    example: 'PENDING_PAYMENT',
  })
  status!: TradeStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ required: false })
  completedAt?: Date;
}
