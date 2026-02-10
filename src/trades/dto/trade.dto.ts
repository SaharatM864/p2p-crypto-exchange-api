import { ApiProperty } from '@nestjs/swagger';

export enum TradeStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DISPUTE = 'DISPUTE',
}

export class TradeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  buyerId!: string;

  @ApiProperty()
  sellerId!: string;

  @ApiProperty()
  cryptoAmount!: string;

  @ApiProperty()
  fiatAmount!: string;

  @ApiProperty()
  price!: string;

  @ApiProperty({ enum: TradeStatus, enumName: 'TradeStatus' })
  status!: TradeStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ required: false })
  completedAt?: Date;
}
