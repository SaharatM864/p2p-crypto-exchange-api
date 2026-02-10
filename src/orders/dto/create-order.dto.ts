import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrderSide } from '@prisma/client';

export class CreateOrderDto {
  @ApiProperty({ enum: OrderSide, example: 'SELL' })
  @IsEnum(OrderSide)
  @IsNotEmpty()
  side!: OrderSide;

  @ApiProperty({ example: 'BTC' })
  @IsString()
  @IsNotEmpty()
  cryptoCurrency!: string;

  @ApiProperty({ example: 'THB' })
  @IsString()
  @IsNotEmpty()
  fiatCurrency!: string;

  @ApiProperty({ example: 1500000, description: 'Price per 1 unit of crypto' })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({ example: 1.0, description: 'Total crypto amount' })
  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @ApiProperty({ example: 100, required: false })
  @IsNumber()
  @IsOptional()
  @Min(0)
  minLimit?: number;

  @ApiProperty({ example: 1000000, required: false })
  @IsNumber()
  @IsOptional()
  @Min(0)
  maxLimit?: number;
}
