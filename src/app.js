require("dotenv").config();
const { createApp } = require("./createApp");

const { app, config } = createApp();

app.listen(config.port, () => {
  console.log(`MTG Tournament app running at http://localhost:${config.port}`);
});
