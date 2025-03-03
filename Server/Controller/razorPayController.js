import { razorPayInstance } from "../Config/razorPayConfig.js";
import dotenv from 'dotenv';
import crypto from 'crypto';
import userModel from "../Models/userModel.js";
import shopProductModel from "../Models/shopProductModel.js";
import orderModel from "../Models/orderModel.js";

dotenv.config();
const razorPayKeyId = process.env.RAZORPAY_KEY_ID;
const razorPayKeySecret = process.env.RAZORPAY_KEY_SECRET;

export const createRazorPayOrderController = async (req, res) => {
  try {
    if (!razorPayKeyId || !razorPayKeySecret) {
      return res.status(404).json({
        success: false,
        message: "Razorpay credentials not found",
      });
    }

    const user = req.user;
    const { firstName,
      lastName,
      email,
      street,
      city,
      state,
      fulladdress,
      zipcode,
      phone } = req.body;

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    const userCartData = user.cartData;
    if (!userCartData || userCartData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
      });
    }

    let totalAmount = 0;
    const productDetails = [];

    for (const item of userCartData) {
      const product = await shopProductModel.findById(item.productId);
      if (product) {
        totalAmount += product.price * item.quantity;
        productDetails.push({
          productId: item.productId,
          quantity: item.quantity,
          price: product.price,
        });
      } else {
        return res.status(400).json({
          success: false,
          message: `Product not found: ${item.productId}`,
        });
      }
    }

    console.log("Total amount:", totalAmount);

    const rPI = razorPayInstance(razorPayKeyId, razorPayKeySecret);

    const options = {
      amount: totalAmount * 100,
      currency: "INR",
      receipt: `receipt_order_${user._id}`,
    };

    const razorpayOrder = await rPI.orders.create(options);

    const newOrder = new orderModel({
      userId: user._id,
      cartData: productDetails,
      amount: totalAmount,
      address: {
        firstName,
        lastName,
        email,
        street,
        fulladdress,
        city,
        state,
        zipcode,
        phone,
      },
      status: "Pending",
      payment: false,
      razorpayOrder: {
        id: razorpayOrder.id,
        currency: razorpayOrder.currency,
        amount: razorpayOrder.amount / 100,
      },
    });

    await newOrder.save();

    return res.status(200).json({
      success: true,
      message: "Order created successfully",
      order: newOrder,
      razorpayOrder,
    });

  } catch (err) {
    console.error("Error creating Razorpay order:", err);
    return res.status(500).json({
      success: false,
      message: `Razorpay order creation failed: ${err.message}`,
    });
  }
};


export const verifyRazorPayOrderController = async (req, res) => {
  try {
    const userId = req.user;
    const { order_id, payment_id, signature } = req.body;

    if (!order_id || !payment_id || !signature) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    const hmac = crypto.createHmac("sha256", razorPayKeySecret);
    hmac.update(`${order_id}|${payment_id}`);
    const generatedSignature = hmac.digest("hex");

    if (generatedSignature !== signature) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed"
      });
    }

    const order = await orderModel.findOne({ "razorpayOrder.id": order_id });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    order.status = "Completed";
    order.payment = true;
    await order.save();

    const user = await userModel.findById(order.userId);
    console.log(user)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    user.cartData = [];




    await user.save();

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully, cart cleared",
    });

  } catch (error) {
    console.error("Error verifying Razorpay order:", error);
    return res.status(500).json({
      success: false,
      message: `Payment verification failed: ${error.message}`
    });
  }
};

