import time
import psycopg2
from psycopg2.extras import RealDictCursor

from backend.main import DSN, calc_next_run_at
from worker.chain_compiler import start_chain_canvas



def get_due_schedules():
    with psycopg2.connect(DSN) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, chain_id, cron_expr, timezone, next_run_at
                FROM public.process_chain_schedules
                WHERE enabled = true
                  AND next_run_at <= now()
                ORDER BY next_run_at
            """)
            return cur.fetchall()


def update_next_run(schedule_id: int, cron_expr: str, timezone: str):
    next_run_at = calc_next_run_at(cron_expr, timezone)

    with psycopg2.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE public.process_chain_schedules
                SET next_run_at = %s,
                    updated_at = now()
                WHERE id = %s
            """, (next_run_at, schedule_id))
            conn.commit()


def main():
    print("Scheduler worker started")

    while True:
        try:
            schedules = get_due_schedules()

            for s in schedules:
                print(f"Run chain {s['chain_id']} by cron {s['cron_expr']}")

                start_chain_canvas(int(s["chain_id"]))

                update_next_run(
                    schedule_id=s["id"],
                    cron_expr=s["cron_expr"],
                    timezone=s["timezone"]
                )

        except Exception as e:
            print(f"Scheduler error: {e}")

        time.sleep(15)


if __name__ == "__main__":
    main()