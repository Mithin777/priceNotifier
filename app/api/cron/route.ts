import { NextResponse } from "next/server";
import {
  getLowestPrice,
  getHighestPrice,
  getAveragePrice,
  getEmailNotifType,
} from "@/lib/utils";
import { connectToDB } from "@/lib/mongoose";
import Product from "@/lib/models/product.model";
import { scrapeAmazonProduct } from "@/lib/scraper";
import { generateEmailBody, sendEmail } from "@/lib/nodemailer";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    await connectToDB(); // 👈 IMPORTANT - await it

    const products = await Product.find({});
    if (!products || products.length === 0) {
      return NextResponse.json({ message: "No products found" });
    }

    const updatedProducts = await Promise.all(
      products.map(async (currentProduct) => {
        try {
          const scrapedProduct = await scrapeAmazonProduct(currentProduct.url);
          if (!scrapedProduct) return null;

          const updatedPriceHistory = [
            ...currentProduct.priceHistory,
            { price: scrapedProduct.currentPrice },
          ];

          const productData = {
            ...scrapedProduct,
            priceHistory: updatedPriceHistory,
            lowestPrice: getLowestPrice(updatedPriceHistory),
            highestPrice: getHighestPrice(updatedPriceHistory),
            averagePrice: getAveragePrice(updatedPriceHistory),
          };

          const updatedProduct = await Product.findOneAndUpdate(
            { url: productData.url },
            productData,
            { new: true }
          );

          const emailNotifType = getEmailNotifType(scrapedProduct, currentProduct);

          if (emailNotifType && updatedProduct?.users?.length > 0) {
            const emailContent = await generateEmailBody(
              {
                title: updatedProduct.title,
                url: updatedProduct.url,
              },
              emailNotifType
            );
            const userEmails = updatedProduct.users.map((user) => user.email);
            await sendEmail(emailContent, userEmails);
          }

          return updatedProduct;
        } catch (innerError) {
          console.error("❌ Error updating product:", currentProduct.url, innerError);
          return null;
        }
      })
    );

    return NextResponse.json({
      message: "Cron completed successfully",
      totalUpdated: updatedProducts.filter(Boolean).length,
    });
  } catch (error) {
    console.error("🚨 Cron Job Failed:", error);
    return NextResponse.json(
      { error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
