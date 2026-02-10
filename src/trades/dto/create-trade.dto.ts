import { IsNotEmpty, IsNumber, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTradeDto {
  @ApiProperty({ example: 'uuid-of-order' })
  @IsUUID()
  @IsNotEmpty()
  orderId!: string;

  @ApiProperty({ example: 0.5, description: 'Amount of crypto to buy/sell' })
  @IsNumber()
  @Min(0)
  amount!: number;
}
