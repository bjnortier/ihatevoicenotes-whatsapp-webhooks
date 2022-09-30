import express, { Express } from "express"
import { transports, format, createLogger } from "winston"
import { inspect } from "util"
import xhub from "express-x-hub"
import bodyParser from "body-parser"
import "crypto"
import { createClient } from "redis"

/**
 * Required environment variables
 */
;["PORT", "TOKEN", "APP_SECRET", "REDIS_URL", "QUEUE_KEY"].forEach((key) => {
  if (process.env[key] === undefined) {
    console.error(`Environment variable ${key} is required`)
    process.exit(1)
  }
})
const TOKEN = process.env.TOKEN
const PORT = process.env.PORT
const APP_SECRET = process.env.APP_SECRET
const REDIS_URL = process.env.REDIS_URL
const QUEUE_KEY = process.env.QUEUE_KEY
const LOG_LEVEL = process.env.LOG_LEVEL || "info"

/**
 * Logging
 */
const humanReadableFormat = format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`
})
const winstonOptions = {
  level: LOG_LEVEL.toLowerCase(),
  format: format.combine(
    format.timestamp(),
    format.json(),
    humanReadableFormat
  ),
  transports: [new transports.Console()],
}
const logger = createLogger(winstonOptions)

/**
 * Redis
 */
const client = createClient({
  url: REDIS_URL,
})

/**
 * App & routes
 */
const app: Express = express()

app.use(xhub({ algorithm: "sha1", secret: APP_SECRET }))
app.use(bodyParser.json())

/**
 * Routes
 */

app.get("/", function (req, res) {
  res.json("[]")
})

app.get("/whatsapp", function (req, res) {
  if (
    req.query["hub.mode"] == "subscribe" &&
    req.query["hub.verify_token"] == TOKEN
  ) {
    res.send(req.query["hub.challenge"])
  } else {
    res.sendStatus(400)
  }
})

app.post("/whatsapp", function (req, res) {
  logger.debug("WhatsApp request body:")
  logger.debug(inspect(req.body, false, null, true))

  // @ts-ignore
  if (!req.isXHubValid()) {
    logger.warn(
      "Warning - request header X-Hub-Signature not present or invalid"
    )
    res.sendStatus(401)
    return
  }

  logger.info("valid webhook reqceived... queueing")
  client.rPush(QUEUE_KEY, [JSON.stringify(req.body)])

  logger.debug("request header X-Hub-Signature validated")
  res.sendStatus(200)
})

// The ERROR logger catches any errors in the routes.
app.use((err, req, res, next) => {
  logger.error(`${req.method} ${req.url} ${err.stack}`)
  next()
})

/**
 * Start
 */
const main = async () => {
  client.on("error", (err) => logger.error(`Redis Client Error: ${err}`))
  client.connect()

  logger.info("Redis client connected")
  app.listen(PORT, () => {
    logger.info(`server listening on port: ${PORT}`)
  })
}

main()
