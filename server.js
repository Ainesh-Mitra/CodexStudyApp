import express from 'express';
const app=express();
app.use(express.static(new URL('./dist',import.meta.url).pathname));
app.listen(process.env.PORT||3000,'0.0.0.0',error=>{if(error){console.error(error.message);process.exitCode=1;return}console.log(`Dayline running on port ${process.env.PORT||3000}`)});
