import { ApiProperty } from '@nestjs/swagger';

export class WalletDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  currencyCode!: string;

  @ApiProperty()
  currencyName!: string;

  @ApiProperty()
  currencyType!: string;

  @ApiProperty()
  availableBalance!: string;

  @ApiProperty()
  lockedBalance!: string;

  @ApiProperty()
  pendingBalance!: string;

  @ApiProperty()
  totalBalance!: string;
}
