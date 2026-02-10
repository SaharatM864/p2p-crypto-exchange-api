# P2P Crypto Exchange API

ระบบตัวกลางแลกเปลี่ยน Cryptocurrencies แบบ Peer-to-Peer (P2P) พัฒนาด้วย **NestJS + Prisma + PostgreSQL**

รองรับการซื้อ-ขาย BTC, ETH, XRP, DOGE ด้วยสกุลเงิน Fiat (THB, USD) พร้อมระบบ **Double-Entry Ledger** สำหรับบันทึกธุรกรรมและ **Pessimistic Locking** ป้องกัน Race Condition

## ER Diagram

ดู [ER Diagram ฉบับเต็ม](docs/er-diagram.md) หรือดูภาพรวม:

![ER Diagram](docs/mermaid-diagram.png)

## Tech Stack

| Layer     | Technology        |
| --------- | ----------------- |
| Runtime   | Node.js 20        |
| Framework | NestJS 11         |
| ORM       | Prisma 6          |
| Database  | PostgreSQL 16     |
| Auth      | JWT (Passport)    |
| Hashing   | Argon2            |
| Docs      | Swagger (OpenAPI) |
| Container | Docker Compose    |

## Quick Start

### Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **Docker & Docker Compose** ([Download](https://www.docker.com/))

### ขั้นตอนรัน (3 คำสั่ง)

```bash
# 1. Start Database + Install Dependencies
docker-compose up -d && npm install

# 2. Migrate + Seed ข้อมูล
npx prisma migrate dev && npx prisma db seed

# 3. Start Server
npm run start:dev
```

เมื่อสำเร็จ:

- **API Server**: http://localhost:3000
- **Swagger UI**: http://localhost:3000/api/docs

## Demo Accounts

| Email             | Password      | บทบาท                   |
| ----------------- | ------------- | ----------------------- |
| `admin@p2p.com`   | `password123` | Admin — มีเงินทุกสกุล   |
| `buyer@demo.com`  | `password123` | ผู้ซื้อ — มี 50,000 THB |
| `seller@demo.com` | `password123` | ผู้ขาย — มี 2.5 BTC     |
| `fees@p2p.com`    | `password123` | System Fee Collector    |

> **Demo Scenario**: มี Trade สถานะ `PAID` พร้อมให้ login เป็น `seller@demo.com` แล้วกด Release ได้เลย

## API Documentation

### วิธีที่ 1: Swagger UI (แนะนำ)

เปิด http://localhost:3000/api/docs → กด **Authorize** → ใส่ Token จาก Login

### วิธีที่ 2: Postman

1. Import `postman/P2P-Crypto-Exchange-API.postman_collection.json`
2. Import `postman/P2P-Crypto-Exchange-API.postman_environment.json`
3. เลือก Environment → เริ่มยิง API ได้เลย

## Flow การทำงานหลัก

```
1. Register + Login → ได้ JWT Token
2. ดูกระเป๋าเงิน → GET /wallets/me
3. ตั้งขาย BTC → POST /orders (side=SELL) → ระบบ Lock เหรียญ
4. ผู้ซื้อตอบรับ → POST /trades → สร้าง Trade (PENDING_PAYMENT)
5. ผู้ซื้อโอนเงิน → POST /trades/:id/pay → สถานะ PAID
6. ผู้ขายปล่อยเหรียญ → POST /trades/:id/release → COMPLETED
   → Ledger Entry: Seller -BTC, Buyer +BTC, System +Fee
```

## ฟีเจอร์หลัก

- **P2P Trading**: ตั้งซื้อ-ขาย Crypto ด้วย Fiat พร้อม Escrow
- **Double-Entry Ledger**: ใช้ระบบบัญชีคู่ ทุกธุรกรรมมี Debit/Credit
- **Pessimistic Locking**: ป้องกัน Double Spending ด้วย `SELECT FOR UPDATE`
- **Concurrency Safe**: มี E2E Test ยืนยัน Race Condition Protection
- **Financial Precision**: ใช้ `DECIMAL(36,18)` ไม่มี Float

## Testing

```bash
# Unit Tests
npm run test

# E2E Tests (รวม Concurrency Test)
npm run test:e2e
```

## Project Structure

```
src/
├── auth/        # สมัครสมาชิก / Login (JWT)
├── orders/      # ตั้งซื้อ-ขาย (Maker)
├── trades/      # จับคู่ + Release + Cancel (Taker)
├── wallets/     # กระเป๋าเงิน
├── prisma/      # Database Service
└── common/      # DTO, Decorators, Guards, Filters
```

## Security Notes

### Dependency Overrides

- **js-yaml**: Forced to `^4.1.1` to resolve [GHSA-mh29-5h37-fv8m](https://github.com/advisories/GHSA-mh29-5h37-fv8m) vulnerability in `openapi-to-postmanv2`.

## License

MIT
