#!/bin/sh
set -e

echo "Waiting for PostgreSQL to be ready..."
until nc -z -v -w30 postgres 5432
do
  echo "Waiting for database connection..."
  # wait for 1 seconds before check again
  sleep 1
done

echo "PostgreSQL is up and running!"

echo "Running database migrations (db push)..."
npx prisma db push

echo "Starting the application..."
exec npm start
