const { google } = require("googleapis");
const dayjs = require("dayjs");

const MONTH_MAP = {
    "січня": "01",
    "лютого": "02",
    "березня": "03",
    "квітня": "04",
    "травня": "05",
    "червня": "06",
    "липня": "07",
    "серпня": "08",
    "вересня": "09",
    "жовтня": "10",
    "листопада": "11",
    "грудня": "12",
};
  

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

// 🎂 Birthdays
const BIRTHDAYS_SHEET_ID = "12fJIHBHnFinAskuZEE5RscArIE2hyJ50OgUbyFo0-hc";
const HOLIDAYS_SHEET_ID = "1oZ0gAIgXzBbYF5I3GBOWR5OcEUonBTPmS-CcQ5jnQws";

async function getBirthdays() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: BIRTHDAYS_SHEET_ID,
    range: "Sheet1!A2:B",
  });

  return res.data.values.map(([name, dateStr]) => {
    const [day, month] = dateStr.split(".");
    return {
      name,
      date: dayjs(`${month}-${day}`, "MM-DD"),
    };
  });
}

// 🎉 Holidays
async function getHolidays() {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });
  
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: HOLIDAYS_SHEET_ID,
      range: "Sheet2!A2:B",
    });
  
    return (res.data.values || [])
      .filter(([rawDate, name]) => rawDate && name)
      .map(([rawDate, name]) => {
        const [day, monthUa] = rawDate.split(" ");
        const mm = MONTH_MAP[monthUa.trim().toLowerCase()];
        const dd = day.padStart(2, "0");
  
        return {
          name: name.trim(),
          date: `${mm}-${dd}`,
        };
      });
}

module.exports = {
  getBirthdays,
  getHolidays,
};