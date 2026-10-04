23시 Clinic Flow - Simple

목표: Express / Drizzle / pino / 사전번들 server.mjs를 모두 제거하고, Cloudflare Worker 1개 + PostgreSQL(Hyperdrive) + 정적 HTML만 사용합니다.

중요:
- wrangler.jsonc의 HYPERDRIVE id는 현재 사용 중인 23si-clinic-db의 ID로 바꿔야 합니다.
- 기존 Neon 테이블(clinic_intakes, waiting_list, clinic_revisit_intakes)을 그대로 사용합니다.
- 현재 1차 버전은 신규 접수, 재진 API, 오늘 대기자 조회/상태변경 API와 단순 신규접수 화면만 제공합니다.
- 기존 복잡한 Express/server.mjs는 사용하지 않습니다.
