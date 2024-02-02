import { userModel, cartModel, orderModel } from "../models/model.js";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "crypto";

dotenv.config();

const keyId = process.env.RAZOR_PAY_KEY_ID;
const secretKey = process.env.RAZOR_PAY_SECRET_KEY;

// POST: Add product to cart
const addToCart = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const userId = req.userId;

    // Check if user is authenticated
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Check if user exists
    const existingUser = await userModel.findById(userId);
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const product = await productModel.findById(productId);

    if (!product) {
      return res.status(400).json({ message: "Product not found" });
    }

    // Check if the product is already in the user's cart
    const existingCartItem = await cartModel.findOne({
      userId,
      "products.productId": productId,
    });

    // Check if the product has the same vendorId as the existing items in the cart
    if (existingCartItem) {
      const isSameVendor =
        existingCartItem.products &&
        existingCartItem.products.every(
          (cartProduct) =>
            cartProduct.vendorId.toString() === product.vendorId.toString()
        );

      if (!isSameVendor) {
        return res.status(400).json({
          message:
            "Cannot add products from different vendors to the same cart",
        });
      }

      // If the product already exists in the cart, increase quantity and update total price
      if (existingCartItem.products && existingCartItem.products.length > 0) {
        await cartModel.findOneAndUpdate(
          {
            userId,
            "products.productId": product._id,
          },
          {
            $inc: { "products.$.quantity": 1 },
            $set: {
              "products.$.totalPrice":
                product.price * (existingCartItem.products[0].quantity + 1),
              grandTotal: existingCartItem.grandTotal + product.price,
            },
          }
        );
      }
    } else {
      // If the product is not in the cart, add it
      await cartModel.findOneAndUpdate(
        { userId },
        {
          $push: {
            products: {
              productId: product._id,
              vendorId: product.vendorId,
              productTitle: product.productTitle,
              price: product.price,
              image: product.image,
              quantity: 1,
              totalPrice: product.price,
            },
          },
          $inc: { grandTotal: product.price },
        },
        { upsert: true }
      );
    }

    return res
      .status(200)
      .json({ message: "Product added to cart successfully" });
  } catch (error) {
    console.error(error);
    next(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUT: Edit quantity of product item endpoint
const updateQuantity = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { Id } = req.params;
    const { quantity } = req.body;

    // If the user is not authenticated
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Find the user
    const existingUser = await userModel.findById(userId);
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find the cart item and update the quantity
    const cartItem = await cartModel.findOneAndUpdate(
      { userId, "products._id": Id },
      { $set: { "products.$.quantity": quantity } },
      { new: true }
    );

    if (!cartItem) {
      return res.status(404).json({ message: "Product not found in the cart" });
    }

    // Recalculate the total price for each product in the cart
    cartItem.products.forEach((product) => {
      product.totalPrice = product.price * product.quantity;
    });

    // Calculate the total price and grand total
    const total = cartItem.products.reduce(
      (acc, item) => acc + item.totalPrice,
      0
    );

    // Update the grand total in the cart
    cartItem.grandTotal = total;

    // Save the updated cart
    await cartItem.save();

    res
      .status(200)
      .json({ message: "Quantity updated successfully", cartItem, total });
  } catch (error) {
    next(error);
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE: Cart item remove
const removeCartItem = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { Id } = req.params;

    // Check if user is authenticated
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Find user
    const existingUser = await userModel.findById(userId);

    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find the cart item and remove the specified product
    const cartItem = await cartModel.findOneAndUpdate(
      { userId },
      { $pull: { products: { _id: Id } } },
      { new: true }
    );

    // If the cart item is not found
    if (!cartItem) {
      return res.status(404).json({ message: "Cart not found for the user" });
    }

    // Recalculate the total price for each product in the cart
    cartItem.products.forEach((product) => {
      product.totalPrice = product.price * product.quantity;
    });

    // Calculate the total price and grand total
    const total = cartItem.products.reduce(
      (acc, item) => acc + item.totalPrice,
      0
    );

    // Update the grand total in the cart
    cartItem.grandTotal = total;

    // Save the updated cart
    await cartItem.save();

    res.status(200).json({
      message: "Product removed from cart successfully",
      cartItem,
      total,
    });
  } catch (error) {
    next(error);
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// View Cart
const viewCart = async (req, res, next) => {
  try {
    const userId = req.userId;

    // Check if user is authenticated
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Find the user and their cart
    const user = await userModel.findById(userId);
    const cartItem = await cartModel.findOne({ userId });

    if (!user || !cartItem) {
      return res.status(404).json({ message: "User or cart not found" });
    }

    res.status(200).json({
      message: "Cart retrieved successfully",
      cart: cartItem,
      grandTotal: cartItem.grandTotal,
    });
  } catch (error) {
    next(error);
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

//POST:select address from the address model and add to Cart
const selectAddressAddToCart = async (req, res, next) => {
  try {
    //check if user is authenticated
    const userId = req.userId;
    const { addressId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Find the selected address from the address model
    const selectedAddress = await userAddressModel.findById(addressId);

    if (!selectedAddress) {
      return res
        .status(404)
        .json({ message: "Address not found for the user" });
    }

    // Create a cart item with the selected address
    const cartItem = new cartModel({
      street: selectedAddress.street,
      city: selectedAddress.city,
      state: selectedAddress.state,
      landmark: selectedAddress.landmark,
      pincode: selectedAddress.pincode,
    });

    // Save the cart item to the database
    await cartItem.save();

    return res
      .status(200)
      .json({ message: "Address added to cart successfully", cartItem });
  } catch (error) {
    next(error);
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

//POST:Razorpay payment method endpoint
const orderPayment = async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const razorpay = new Razorpay({ key_id: keyId, key_secret: secretKey });

    const options = req.body;
    const order = await razorpay.orders.create(options);

    if (!order) {
      throw new Error("Failed to create order");
    }

    return res.status(200).json(order);
  } catch (error) {
    console.error("Error during payment:", error);
    next(error);
  }
};

//POST:Razorpay payment verify method endpoint
const validatePayment = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const sha = crypto.createHmac("sha256", secretKey);
    sha.update(`${razorpay_order_id}|${razorpay_payment_id}`);

    const digest = sha.digest("hex");

    if (digest !== razorpay_signature) {
      return res.status(400).json({ message: "Transation is not Success" });
    }

    res.status(200).json({
      message: "Transation Successfull",
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
    });
  } catch (error) {
    console.error("Error during verification", error);
    next(error);
  }
};

//POST: payment details will save to database
const order = async (req, res, next) => {
  try {
    const { orderId, paymentId, cartId, userId, addressId, vendorId, total } =
      req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const existingUser = await userModel.findById(userId);

    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch all details from the user
    const userDetails = await userModel.findById(userId);
    // Fetch user details from the userModel
    const userAddress = await userAddressModel.findById(addressId);
    // Fetch cart items from the cart model
    const cartData = await cartModel.findById(cartId).lean();
    const cartItems = cartData ? cartData.products : [];

    // Create an array to store the structured cart items
    const formattedCartItems = [];

    // Iterate through each product in the cartItems array
    for (const product of cartItems) {
      formattedCartItems.push({
        productId: product.productId,
        vendorId: product.vendorId,
        productTitle: product.productTitle,
        price: product.price,
        image: product.image,
        quantity: product.quantity,
        totalPrice: product.totalPrice,
        _id: product._id,
      });
    }

    // Create the order details object
    const orderDetails = new orderModel({
      orderId,
      paymentId,
      vendorId,
      userId,
      total,
      name: userDetails.name,
      email: userDetails.email,
      mobile: userDetails.mobile,
      address: {
        street: userAddress.street,
        city: userAddress.city,
        state: userAddress.state,
        landmark: userAddress.landmark,
        pincode: userAddress.pincode,
      },
      cartItems: formattedCartItems,
    });

    await orderDetails.save();

    res
      .status(200)
      .json({ message: "Successfully saved Order Details", orderDetails });
  } catch (error) {
    next(error);
    console.error("Failed to save to the database");
  }
};

export {
  addToCart,
  viewCart,
  updateQuantity,
  removeCartItem,
  selectAddressAddToCart,
  orderPayment,
  validatePayment,
  order,
};
