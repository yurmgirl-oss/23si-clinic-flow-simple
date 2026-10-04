import { Client } from "pg";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function db(env, work) {
  if (!env.HYPERDRIVE?.connectionString) throw new Error("HYPERDRIVE binding이 없습니다.");
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function createIntake(request, env) {
  const b = await request.json();
  const required = ["guardianName", "guardianPhone", "petName", "petType", "breed", "gender", "age", "weightKg", "reason"];
  for (const k of required) if (b[k] === undefined || b[k] === null || String(b[k]).trim() === "") return json({ error: `${k} 입력이 필요합니다.` }, 400);
  if (!b.privacyConsent || !b.safetyConsent) return json({ error: "동의 항목을 확인해주세요." }, 400);

  const result = await db(env, async (client) => {
    await client.query("BEGIN");
    try {
      const intake = await client.query(
        `INSERT INTO clinic_intakes
        (guardian_name,address,guardian_phone,pet_name,pet_type,pet_type_detail,breed,gender,birth_date,age,weight_kg,neutered,temperament,reason,planned_visit_date,planned_visit_period,additional_treatments,privacy_consent,safety_consent,safety_signature,exam_fee_consent,status,call_message,memo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        RETURNING id`,
        [b.guardianName, b.address || "", b.guardianPhone, b.petName, b.petType, b.petTypeDetail || null, b.breed, b.gender, b.birthDate || null,
         Number(b.age), Number(b.weightKg), Boolean(b.neutered), b.temperament || "", b.reason, b.plannedVisitDate || null, b.plannedVisitPeriod || null,
         Array.isArray(b.additionalTreatments) ? b.additionalTreatments : [], true, true, b.safetySignature || null, Boolean(b.examFeeConsent), "접수완료", b.callMessage || null, b.memo || null]
      );
      const intakeId = intake.rows[0].id;
      const q = await client.query(`SELECT COALESCE(MAX(queue_number),0)+1 AS n FROM waiting_list WHERE checked_in_at::date = CURRENT_DATE`);
      const queueNumber = Number(q.rows[0].n);
      await client.query(`INSERT INTO waiting_list (intake_id,queue_number,status) VALUES ($1,$2,'대기중')`, [intakeId, queueNumber]);
      await client.query(`UPDATE clinic_intakes SET status='대기중' WHERE id=$1`, [intakeId]);
      await client.query("COMMIT");
      return { intakeId, queueNumber };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
  return json({ success: true, ...result });
}

async function createRevisit(request, env) {
  const b = await request.json();

  if (!b.guardianPhone || !b.petName || !b.reason) {
    return json({ error: "전화번호, 동물명, 진료내용은 필수입니다." }, 400);
  }

  const result = await db(env, async (client) => {
    await client.query("BEGIN");

    try {
      const r = await client.query(
        `INSERT INTO clinic_revisit_intakes
        (guardian_phone,pet_name,reason,planned_visit_date,planned_visit_period,additional_treatments,status,call_message,memo)
        VALUES ($1,$2,$3,$4,$5,$6,'대기중',$7,$8)
        RETURNING id, public_token`,
        [
          b.guardianPhone,
          b.petName,
          b.reason,
          b.plannedVisitDate || null,
          b.plannedVisitPeriod || null,
          Array.isArray(b.additionalTreatments) ? b.additionalTreatments : [],
          b.callMessage || null,
          b.memo || null
        ]
      );

      const revisitId = r.rows[0].id;

      const q = await client.query(
        `SELECT COALESCE(MAX(queue_number),0)+1 AS queue_number
         FROM waiting_list
         WHERE status='대기중'`
      );

      const queueNumber = Number(q.rows[0].queue_number);

      await client.query(
        `INSERT INTO waiting_list
        (intake_id,revisit_intake_id,queue_number,status)
        VALUES (NULL,$1,$2,'대기중')`,
        [revisitId, queueNumber]
      );

      await client.query("COMMIT");

      return {
        revisitId,
        publicToken: r.rows[0].public_token,
        queueNumber
      };

    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });

  return json({
    success: true,
    ...result
  });
}

async function getWaiting(env) {
  const rows = await db(env, async (client) => {
    const r = await client.query(`
      SELECT
        w.id,
        w.queue_number,
        w.status,
        w.checked_in_at,
        COALESCE(i.pet_name, r.pet_name) AS pet_name,
        COALESCE(i.pet_type, '재진') AS pet_type,
        COALESCE(i.breed, '') AS breed,
        COALESCE(i.guardian_name, '') AS guardian_name,
        COALESCE(i.guardian_phone, r.guardian_phone) AS guardian_phone,
        COALESCE(i.reason, r.reason) AS reason
      FROM waiting_list w
      LEFT JOIN clinic_intakes i
        ON i.id = w.intake_id
      LEFT JOIN clinic_revisit_intakes r
        ON r.id = w.revisit_intake_id
      WHERE w.checked_in_at::date = CURRENT_DATE
        
      ORDER BY w.queue_number
    `);

    return r.rows;
  });

  return json(rows);
}

async function updateWaiting(request, env) {
  const b = await request.json();
  if (!b.id || !b.status) return json({ error: "id와 status가 필요합니다." }, 400);
  await db(env, async (client) => {
    await client.query(`UPDATE waiting_list SET status=$1 WHERE id=$2`, [b.status, b.id]);
  });
  return json({ success: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true });
      if (request.method === "POST" && url.pathname === "/api/intakes") return await createIntake(request, env);
      if (request.method === "POST" && url.pathname === "/api/revisit-intakes") return await createRevisit(request, env);
      if (request.method === "GET" && url.pathname === "/api/waiting") return await getWaiting(env);
      if (request.method === "POST" && url.pathname === "/api/waiting/status") return await updateWaiting(request, env);
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }
};
