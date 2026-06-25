const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function testLogin() {
  try {
    console.log("Testing login credentials...");

    const user = await prisma.user.findUnique({
      where: { email: "admin@securite.com" },
      select: {
        id: true,
        email: true,
        password: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      console.log("User not found");
      return;
    }

    console.log("User found:", user.email);
    console.log("User active:", user.isActive);

    // Test password verification
    const isValid = await bcrypt.compare("admin123", user.password);
    console.log("Password valid:", isValid);

    if (isValid) {
      console.log("Login should work!");
    } else {
      console.log("Password verification failed");
      console.log("Recreating user with new password...");

      const hashedPassword = await bcrypt.hash("admin123", 10);
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      console.log("Password updated for admin user");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

testLogin();
