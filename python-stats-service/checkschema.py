import os
import psycopg2

DB_URL = os.getenv('DATABASE_URL')
if not DB_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set. Set it in your .env file before running this script.")

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

# Show all columns in matchups table
cur.execute("""
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'matchups'
    ORDER BY ordinal_position;
""")

print("Matchups table columns:")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]}")

cur.close()
conn.close()