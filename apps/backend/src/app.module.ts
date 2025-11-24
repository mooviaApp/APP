import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { SensorModule } from './sensor/sensor.module';

@Module({
  imports: [UsersModule, WorkoutsModule, SensorModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
