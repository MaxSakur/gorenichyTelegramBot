const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const dayjs = require("dayjs");
require("dotenv").config();
const axios = require("axios");

require("dayjs/locale/ru");
dayjs.locale("ru");

const { getBirthdays, getHolidays } = require("./google");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "ТВОЙ_ТОКЕН";
const CHAT_ID = process.env.CHAT_ID || "-4531405743";
const CRON_MINUTE = 0;
const CRON_HOUR_KYIV = 9;
const bot = new TelegramBot(TOKEN, { polling: true });

bot.on("message", (msg) => {
  console.log("Chat ID:", msg.chat.id);
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  const currencyMsg = await getCurrencyRates();  
  const weather = await getWeatherForecast();
  const birthdayMsg = await getNearestBirthdayMessage();
  const holidayMsg = await getNearestHolidayMessage();

  const parts = [
    "👋 Привет, пятачок!",
    `Сегодня - ${weather}`,
    currencyMsg,
    birthdayMsg
  ];
  if (holidayMsg) parts.push(holidayMsg);

  const greeting = parts.join("\n\n");

  bot.sendMessage(chatId, greeting, {
    parse_mode: "Markdown"
  });
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

  if (query.data === "nearest_birthday") {
    const msg = await getNearestBirthdayMessage();
    bot.sendMessage(chatId, msg);
  }

  if (query.data === "nearest_holiday") {
    const msg = await getNearestHolidayMessage();
    bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
  }

  bot.answerCallbackQuery(query.id);
});

cron.schedule(`${CRON_MINUTE} ${CRON_HOUR_KYIV} * * *`, async () => {
  try {
    await checkBirthdaysAndHolidays();

    const weather = await getWeatherForecast();
    const currencyMsg = await getCurrencyRates();
    const birthdayMsg = await getNearestBirthdayMessage();
    const holidayMsg = await getNearestHolidayMessage();

    const parts = [
      "👋 Добрый день, пятачек!",
      `Сегодня - ${weather}`,
      currencyMsg,
      birthdayMsg
    ];
    if (holidayMsg) parts.push(holidayMsg);

    const greeting = parts.join("\n\n");

    await bot.sendMessage(CHAT_ID, greeting, { parse_mode: "Markdown" });
    console.log("✅ Рассылка отправлена");
  } catch (err) {
    console.error("❌ Ошибка в cron-задаче:", err);
  }
}, {
  timezone: "Europe/Kyiv"
});

async function getWeatherForecast() {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const lat = 50.4366;
  const lon = 30.2353;
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&lang=ru&appid=${apiKey}`;

  try {
    const res = await axios.get(url);
    const today = dayjs().format("YYYY-MM-DD");
    const tomorrow = dayjs().add(1, "day").format("YYYY-MM-DD");

    const todayForecasts = res.data.list.filter(entry =>
      entry.dt_txt.startsWith(today)
    );
    const tomorrowForecasts = res.data.list.filter(entry =>
      entry.dt_txt.startsWith(tomorrow)
    );

    const dayForecast = pickClosestForecast(todayForecasts, 12);
    const nightForecast = pickClosestForecast(tomorrowForecasts, 3);

    const dayDesc = dayForecast?.weather?.[0]?.description || "нет данных";
    const icon = getWeatherEmoji(dayDesc);
    const dayTemp = dayForecast?.main?.temp;
    const nightTemp = nightForecast?.main?.temp;
    const clouds = dayForecast?.clouds?.all;
    const wind = dayForecast?.wind?.speed;

    const dateText = `${icon} *${capitalize(dayjs().format("dddd, D MMMM"))}*`;

    return `${dateText}\nПогода: ${capitalize(dayDesc)}\nТемпература: днём ${formatTemp(dayTemp)}° / ночью ${formatTemp(nightTemp)}°\n☁️ Облачность: ${clouds ?? "—"}%\n🌬 Ветер: ${wind ?? "—"} м/с`;
  } catch {
    return "❌ Не удалось загрузить прогноз погоды";
  }
}

function pickClosestForecast(forecasts, targetHour) {
  if (!forecasts?.length) return undefined;
  const target = dayjs().hour(targetHour).minute(0).second(0);

  return forecasts.reduce((closest, curr) => {
    const currTime = dayjs(curr.dt_txt);
    const closestTime = dayjs(closest.dt_txt);
    return Math.abs(currTime.diff(target)) < Math.abs(closestTime.diff(target)) ? curr : closest;
  }, forecasts[0]);
}

function getWeatherEmoji(desc) {
  const d = desc.toLowerCase();
  if (d.includes("дожд") || d.includes("ливень")) return "🌧";
  if (d.includes("облачно")) return "☁️";
  if (d.includes("ясно")) return "☀️";
  if (d.includes("снег")) return "❄️";
  if (d.includes("гроза")) return "⛈";
  if (d.includes("ветер")) return "🌬";
  return "🌤";
}

function formatTemp(t) {
  if (typeof t !== "number") return "—";
  return t > 0 ? `+${Math.round(t)}` : `${Math.round(t)}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function getNearestBirthdayMessage() {
  const birthdays = await getBirthdays();
  const today = dayjs();

  const upcoming = birthdays
    .map(({ name, date }) => {
      const monthDay = date.format("MM-DD");
      let bday = dayjs(`${today.year()}-${monthDay}`, "YYYY-MM-DD");

      if (bday.isBefore(today, "day")) {
        bday = bday.add(1, "year");
      }

      return { name, date: bday };
    })
    .sort((a, b) => a.date.diff(b.date));

  const nearestDate = upcoming[0]?.date;
  const nearest = upcoming.filter(b => b.date.isSame(nearestDate, "day"));

  if (!nearest.length) return "🎂 Ближайших дней рождений нет";

  const msg = nearest
    .map(b => `👤 ${b.name} — ${b.date.format("DD.MM")} (через ${b.date.diff(today, "day")} дн.)`)
    .join("\n");

  return `📅 *Ближайшие дни рождения:*\n${msg}`;
}

async function getCurrencyRates() {
  const url = process.env.NBU_API_URL || "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangenew?json";

  try {
    const res = await axios.get(url);
    const data = res.data;

    const usd = data.find(c => c.cc === "USD");
    const eur = data.find(c => c.cc === "EUR");
    const pln = data.find(c => c.cc === "PLN");

    return `💱 *Курс валют НБУ:*\n🇺🇸 USD: ${usd?.rate?.toFixed(2)} ₴\n🇪🇺 EUR: ${eur?.rate?.toFixed(2)} ₴\n🇵🇱 PLN: ${pln?.rate?.toFixed(2)} ₴`;
  } catch {
    return "❌ Не удалось загрузить курсы валют";
  }
}

async function getNearestHolidayMessage() {
  const holidays = await getHolidays();
  const today = dayjs().format("MM-DD");

  const todayHolidays = holidays.filter(h => h.date === today);

  if (!todayHolidays.length) return "";

  const list = todayHolidays
    .map(h => `🎊 ${h.name}`)
    .join("\n");

  return `📅 *Праздники сегодня (${dayjs().format("DD.MM.YYYY")}):*\n${list}`;
}

async function checkBirthdaysAndHolidays() {
  const today = dayjs();
  const birthdays = await getBirthdays();
  const holidays = await getHolidays();

  birthdays.forEach(({ name, date }) => {
    const bday = dayjs(`${today.year()}-${date.format("MM-DD")}`, "YYYY-MM-DD");
    const diff = bday.diff(today, "day");

    let msg = "";
    if (diff === 7) msg = `🎉 Через неделю у ${name} день рождения!`;
    else if (diff === 3) msg = `🎈 Через 3 дня у ${name} день рождения!`;
    else if (diff === 1) msg = `🎁 Завтра у ${name} день рождения!`;
    else if (diff === 0) msg = `🎂 Сегодня у ${name} день рождения!`;

    if (msg) bot.sendMessage(CHAT_ID, msg);
  });
}

console.log("Бот запущен ✅");