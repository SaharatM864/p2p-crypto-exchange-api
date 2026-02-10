import { ApiProperty } from '@nestjs/swagger';

export class WalletDto {
  @ApiProperty({ example: 'uuid-wallet-id' })
  id!: string;

  @ApiProperty({ example: 'BTC' })
  currencyCode!: string;

  @ApiProperty({ example: 'Bitcoin' })
  currencyName!: string;

  @ApiProperty({ example: 'CRYPTO' })
  currencyType!: string;

  @ApiProperty({ example: '1.5' })
  availableBalance!: string;

  @ApiProperty({ example: '0.5' })
  lockedBalance!: string;

  @ApiProperty({ example: '0.0' })
  pendingBalance!: string;

  @ApiProperty({ example: '2.0' })
  totalBalance!: string;
}
