import psycopg2

DB_URL = "postgresql://neondb_owner:npg_2RpxLi7PZYAH@ep-summer-grass-afx8wu4n.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require"

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