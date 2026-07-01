
### Flow for migrations
Ensure the docker container is running in the background for this
- Create a new file in the src/db/schema folder
- Export it in the src/db/schema/index.ts file
- In the CLI, run ```pnpm run db:generate``` 
- The previous step will generate a migrations file in the migrations folder
- Run ```pnpm run db:migrate``` to run the migrations 