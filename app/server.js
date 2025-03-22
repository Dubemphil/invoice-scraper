const express = require("express");
const app = express();
const PORT = process.env.PORT || 8080; // Cloud Run expects 8080

// Import your scraper and Google Sheet functions
const { scrapeInvoices } = require("./scraper");
const { updateGoogleSheet } = require("./googlesheet");

// Route to trigger scraping and update Google Sheet
app.get("/scrape", async (req, res) => {
  try {
    const result = await scrapeInvoices(); // Scrape data
    await updateGoogleSheet(result); // Update Google Sheet
    res.send("Scraping and Google Sheet update completed!");
  } catch (error) {
    console.error("Error during scraping:", error);
    res.status(500).send("Something went wrong.");
  }
});

// Health check route
app.get("/", (req, res) => {
  res.send("Invoice Scraper is running...");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
