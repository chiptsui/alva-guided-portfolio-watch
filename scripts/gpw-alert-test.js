"use strict";
/**
 * gpw-alert-test.js
 * ISOLATED NOTIFICATION DELIVERY TEST — NOT A PORTFOLIO ALERT.
 *
 * Purpose: Verify the V2 alertOutput delivery path (feed write → FEED_ALERT → web channel)
 * independently of the @alva/portfolio-watch analysis pipeline.
 *
 * This script:
 *   - Emits exactly one clearly labeled test alert record.
 *   - Makes no calls to @alva/portfolio-watch.
 *   - Consumes no financial data APIs.
 *   - Touches no production monitoring state or dedup baseline.
 *
 * Intended for a single authorized trigger of the gpw-alert-test cronjob only.
 * Do not deploy or schedule as a recurring automation.
 */

const { Feed, feedPath, makeDoc, str, alertOutput } = require("@alva/feed");

const feed = new Feed({ path: feedPath("gpw-alert-test") });

feed.def("alerts", {
  test: alertOutput(makeDoc(
    "GPW Delivery Test Alert",
    "Isolated one-shot notification delivery verification",
    [
      str("title"),
      str("body"),
    ]
  )),
});

(async () => {
  await feed.run(async (ctx) => {
    await ctx.self.ts("alerts", "test").append([{
      date:  Date.now(),
      title: "GPW Notification Delivery Test",
      body:  "This is a controlled delivery verification for Guided Portfolio Watch. "
           + "It is not a portfolio alert and contains no market information. "
           + "Safe to dismiss.",
    }]);
  });
})();
