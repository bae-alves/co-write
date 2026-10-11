plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    application
}

group = "dev.cowrite"
version = "0.0.0"

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("dev.cowrite.server.MainKt")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.server.cors)
    implementation(libs.ktor.server.websockets)
    implementation(libs.ktor.serialization.json)
    implementation(libs.serialization.json)
    implementation(libs.hikari)
    implementation(libs.postgres)
    implementation(libs.logback)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.ktor.server.test.host)
}

tasks.test {
    useJUnitPlatform()
}
